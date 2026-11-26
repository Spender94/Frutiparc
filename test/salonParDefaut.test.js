'use strict';
/*
 * « SALON PAR DÉFAUT » — la préférence n° 1 (`default_channel`).
 *
 * Elle était enregistrée mais jamais lue : le light ouvrait toujours le
 * premier salon (pomme, le n° 2). Et la fenêtre « Mes préférences » la
 * montrait en chiffre nu, sans dire qu'à 0 correspond « au hasard ».
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function extraire(src, re) {
  const m = re.exec(src);
  assert.ok(m, `introuvable : ${re}`);
  return m[0];
}

// Les fonctions du light, exécutées pour de vrai.
const ctx = vm.createContext({});
vm.runInContext([
  extraire(LIGHT, /var ROOMS = \[[\s\S]*?\];/),
  extraire(LIGHT, /var SALON_AUCUN = "";/),
  extraire(LIGHT, /var SALONS_PAR_NUMERO = [\s\S]*?\];/),
  extraire(LIGHT, /function salonDuNumero\([\s\S]*?\n  \}/),
  extraire(LIGHT, /function decode62Light\([\s\S]*?\n  \}/),
].join('\n'), ctx);

test('chaque numéro ouvre le salon du bureau Flash', () => {
  const attendus = { 2: 'pomme', 3: 'abricot', 4: 'poire', 5: 'fraise', 6: 'citron',
    7: 'kiwi', 8: 'raisin', 9: 'orange', 10: 'cerise', 11: 'banane' };
  for (const [n, id] of Object.entries(attendus)) {
    assert.strictEqual(ctx.salonDuNumero(Number(n)), id, `n° ${n}`);
  }
});

test('0 tire un salon au hasard parmi les dix', () => {
  assert.strictEqual(ctx.salonDuNumero(0, 0), 'pomme');
  assert.strictEqual(ctx.salonDuNumero(0, 0.999), 'banane');
  assert.strictEqual(ctx.salonDuNumero(0, 0.5), 'kiwi');
});

test('sans choix enregistré, le salon par défaut est pomme (n° 2)', () => {
  assert.match(SERVEUR, /\{ id: 1,\s+type: 'i', name: 'default_channel',\s+def: encode62\(2\) \}/);
  assert.strictEqual(ctx.salonDuNumero(2), 'pomme');
  assert.strictEqual(ctx.ROOMS[0][0], 'pomme', 'dernier recours du light');
});

test('un numéro que le light ne sait pas ouvrir retombe sur le premier salon', () => {
  for (const n of [1, 12, 14, 99]) assert.strictEqual(ctx.salonDuNumero(n), 'pomme');
});

test('13, « Aucun salon », n’en rejoint aucun', () => {
  assert.strictEqual(ctx.salonDuNumero(13), '');
  // Le bureau ouvre « Salons publics », comme le SWF ouvrait `roomList`.
  assert.match(LIGHT, /if \(id === SALON_AUCUN\) \{[\s\S]*?BureauFrutiz\.ouvrirSalonsPublics\(\)/);
  // Le mobile rejoint le salon de la liste du haut en ouvrant « Salon ».
  assert.match(LIGHT, /tab === "chat" && !state\.room && state\.connected && salonDeDepart\(\) === SALON_AUCUN/);
});

test('la valeur stockée se lit en base 62', () => {
  assert.strictEqual(ctx.decode62Light('0'), 0);
  assert.strictEqual(ctx.decode62Light('a'), 10);
  assert.strictEqual(ctx.decode62Light('b'), 11);
});

test('la première connexion passe par la préférence', () => {
  assert.match(LIGHT, /salonParDefaut\(function \(id\) \{/);
  // L'ouverture d'office du premier salon à l'identification n'existe plus.
  const k = extraire(LIGHT, /case "k": \/\/ ident response[\s\S]*?rejoindreLesPrives\(\);/);
  assert.doesNotMatch(k, /ouvrirSalon\(\$\("#room-select"\)\.value \|\| ROOMS\[0\]\[0\]\)/);
});

test('la fenêtre « Mes préférences » propose des noms de salons, pas un chiffre', () => {
  assert.match(SERVEUR, /default_channel:[^\n]*\n\s*choices: SALONS_DEFAUT/);
  const liste = extraire(SERVEUR, /const SALONS_DEFAUT = \[[\s\S]*?\n\];/);
  assert.match(liste, /\[0, 'Au hasard'\]/);
  assert.match(liste, /\[13, 'Aucun salon'\]/);
  // Onze choix et plus : une liste déroulante dans la fenêtre du bureau.
  assert.match(SERVEUR, /choices: SALONS_DEFAUT, liste: true \}/);
  const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  assert.match(BUREAU, /if \(choix && p\.liste\) \{\s*\n\s*var s = document\.createElement\('select'\);/);
  for (let n = 2; n <= 11; n++) assert.match(liste, new RegExp(`\\[${n}, '`));
});

test('le bureau attend la préférence avant d’ouvrir la fenêtre du salon', () => {
  // Sans cela, la fenêtre prenait le premier salon (pomme) avant la connexion,
  // et l'identification trouvait un salon déjà ouvert : la préférence n'était
  // jamais appliquée sur ordinateur.
  assert.match(LIGHT, /oublierSalonParDefaut\(\);\s*\n\s*if \(window\.BureauFrutiz && BureauFrutiz\.actif && BureauFrutiz\.actif\(\)\) \{[\s\S]*?salonParDefaut\(function \(id\) \{/);
  assert.match(LIGHT, /depart: function \(\) \{ return salonDeDepart\(\); \}/);
  const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  const f = extraire(BUREAU, /function salonCourant\(\) \{[\s\S]*?\n  \}/);
  assert.ok(f.indexOf('S.depart') < f.indexOf('S.liste'), 'le salon par défaut passe avant le premier de la liste');
});

test('la préférence n’est lue qu’une fois : un « au hasard » ne tire qu’un salon', () => {
  const f = extraire(LIGHT, /function salonParDefaut\(suite\) \{[\s\S]*?\n  \}/);
  assert.match(f, /if \(salonDefaut\.connu !== null\) \{ suite\(salonDefaut\.connu\); return; \}/);
  assert.match(f, /salonDefaut\.attente\.push\(suite\)/);
});
